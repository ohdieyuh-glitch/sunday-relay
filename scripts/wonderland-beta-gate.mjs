#!/usr/bin/env node
/**
 * THE WONDERLAND BETA GATE.
 *
 * Fourteen capabilities, each resolving to exactly one of PASS, FAIL or
 * NOT BUILT. There is no percentage, no score, no "mostly works" and no fourth
 * value, because every one of those is a way of saying "nearly" to a question
 * that only has two useful answers before a beta.
 *
 * WHAT EACH VERDICT MEANS, stated so FAIL cannot be misread:
 *
 *   NOT BUILT  No production implementation exists in this repository. The
 *              probe looked for named files and did not find them.
 *   FAIL       An implementation exists and the evidence required to believe it
 *              works is absent or shows it did not work. "We have the code" is
 *              not a pass at a beta gate; neither is a green unit test.
 *   PASS       An implementation exists AND real run evidence shows it did its
 *              job. Nothing else produces a PASS.
 *
 * WHY IT CANNOT FLATTER ITSELF. Every runtime capability's PASS requires a
 * LIVE MISSION EVIDENCE BUNDLE — the artifact
 * `.github/workflows/julius-first-live-mission.yml` uploads, downloaded with
 * `gh run download <id>`. Run this gate without one and no runtime capability
 * can reach PASS, structurally: there is no branch that infers a pass from the
 * repository alone. That is the whole design. A gate whose optimistic answer is
 * unreachable cannot be talked into one.
 *
 * REPEATABLE, AND POINTABLE AT ANY RUN:
 *
 *   node scripts/wonderland-beta-gate.mjs
 *   node scripts/wonderland-beta-gate.mjs --evidence <dir> [--json]
 *
 * where <dir> is a downloaded run artifact directory (the gate finds the
 * `julius-live-evidence` folder inside it, or accepts that folder directly).
 *
 * Exit 0 only when every capability is PASS. Anything else exits 1, which is
 * the honest answer to "are we ready for beta".
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------- arguments */

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : null;
};

/* ------------------------------------------------------ repository probes */

/** Built = every named production file is present. A test file never counts. */
const built = (...relativePaths) => {
  const missing = relativePaths.filter((path) => !existsSync(join(REPO, path)));
  return {
    built: missing.length === 0,
    where: missing.length === 0 ? relativePaths.join(', ') : `missing: ${missing.join(', ')}`,
  };
};

/**
 * Built = ANY of these exists, for a capability with no implementation yet.
 *
 * A `build` that returns a hard-coded `false` is not a probe, it is a verdict
 * someone typed — it cannot notice the day the thing gets written. Naming the
 * candidate locations instead means the row flips on its own AND tells whoever
 * builds it where this gate will look.
 */
const builtAny = (...relativePaths) => {
  const found = relativePaths.filter((path) => existsSync(join(REPO, path)));
  return {
    built: found.length > 0,
    where: found.length > 0 ? found.join(', ') : `none of: ${relativePaths.join(', ')}`,
  };
};

/* --------------------------------------------------------- evidence bundle */

/**
 * READS A REAL RUN, OR ADMITS IT HAS NONE.
 *
 * Every accessor answers `null` for "this bundle does not say", never a
 * default. A capability that reads `null` cannot pass, which is the same rule
 * the product applies to its own Unknown values.
 */
function loadEvidence(dir) {
  if (dir === null) return { present: false, source: null, file: () => null, rows: () => [] };
  let root = resolve(dir);
  if (!existsSync(root)) return { present: false, source: `absent: ${root}`, file: () => null, rows: () => [] };
  if (!existsSync(join(root, 'runs.tsv'))) {
    // Accept the parent directory `gh run download` produces.
    const nested = readdirSync(root)
      .map((entry) => join(root, entry))
      .filter((entry) => statSync(entry).isDirectory() && existsSync(join(entry, 'runs.tsv')));
    if (nested.length !== 1) {
      return { present: false, source: `no julius-live-evidence bundle under ${root}`, file: () => null, rows: () => [] };
    }
    root = nested[0];
  }
  /**
   * `null` MEANS THE BUNDLE DOES NOT SAY, and one of the two ways it can not say
   * is by saying so.
   *
   * `julius-live-evidence-dump.sh` writes the literal `unavailable` into a file
   * whose query it could not run — that is how free dry runs #1 and #2 shipped
   * an `evidence.tsv` reading `unavailable` after naming a column the migrations
   * never created. Read as text it is a one-line file, and a one-line file has
   * no rows, so a table that could not be READ would arrive here as a table that
   * was EMPTY. An empty Project Brain and an unreadable one are opposite facts,
   * and reporting the first for the second is exactly the substitution this
   * product exists to refuse.
   */
  const file = (name) => {
    const path = join(root, name);
    if (!existsSync(path)) return null;
    const text = readFileSync(path, 'utf8');
    return text.trim() === 'unavailable' ? null : text;
  };
  /** TSV rows as objects. The trailing `(n rows)` line psql writes is not a row. */
  const rows = (name) => {
    const text = file(name);
    if (text === null) return [];
    const lines = text.split('\n').filter((line) => line.length > 0 && !/^\(\d+ rows?\)$/.test(line));
    if (lines.length < 2) return [];
    const header = lines[0].split('\t');
    return lines.slice(1).map((line) => {
      const cells = line.split('\t');
      return Object.fromEntries(header.map((key, index) => [key, cells[index] ?? '']));
    });
  };
  return { present: true, source: root, file, rows };
}

/* ----------------------------------------------------------- capabilities */

/**
 * THE OPERATOR IDENTITY, WHICH IS NOT AN ACCOUNT.
 *
 * Both bounded live missions declare `"tenantId": "tenant"`, and the workflow
 * runs them under `RELAY_BRIDGE_API_TOKEN` with
 * `method: 'operator_token'`. A mission owned by that identity proves the
 * pipeline; it proves nothing about a person signing up, creating a project and
 * starting a run. Anything else in `player_id` is a real account, and that is
 * what flips the row.
 */
const OPERATOR_PLAYER_IDS = new Set(['tenant', 'operator']);

/**
 * `path: true` marks a capability on the creation path a mission must walk to
 * reach VERIFIED COMPLETION. The top-three ranking reads it, so the ordering is
 * a declared property rather than a judgement made at run time.
 */
const CAPABILITIES = [
  {
    id: 'ACCOUNT / ONBOARDING', path: false,
    build: () => built('relay-bridge/github-oauth.ts', 'relay-bridge/github-auth-routes.ts', 'src/relay/ui/relay-experience/onboarding.ts'),
    prove: (ev) => {
      if (ev.file('sessions.tsv') === null) {
        return [false, 'this bundle carries no readable execution-session dump, so the account the mission ran for is unknown'];
      }
      const sessions = ev.rows('sessions.tsv');
      if (sessions.length === 0) return [false, 'no execution session was recorded, so no account owns this run'];
      const owners = [...new Set(sessions.map((row) => row.player_id))];
      const real = owners.filter((owner) => !OPERATOR_PLAYER_IDS.has(owner));
      return real.length > 0
        ? [true, `a mission ran for a non-operator account (${real.join(', ')})`]
        : [false, `every session is owned by the operator identity (${owners.join(', ')}), so no real account has started a mission`];
    },
  },
  {
    id: 'PROJECT CREATION', path: true,
    build: () => built('relay-bridge/julius/bootstrap.ts', 'relay-bridge/julius/mission-seed.ts'),
    prove: (ev) => {
      const runs = ev.rows('runs.tsv');
      if (runs.length === 0) return [false, 'no run row in the evidence bundle'];
      const projectBearing = ev.rows('tasks.tsv').length > 0 && runs[0].mission_id;
      return projectBearing
        ? [true, `run ${runs[0].run_id} was created for mission ${runs[0].mission_id}`]
        : [false, 'a run row exists but names no mission'];
    },
  },
  {
    id: 'JULIUS MISSION START', path: true,
    build: () => built('relay-bridge/julius-live-mission.ts', 'src/relay/mission/julius/julius-run-loop.ts'),
    prove: (ev) => {
      const text = ev.file('live-mission.evidence.txt') ?? '';
      const accepted = /^Run \S+ accepted in state READY; driving the Julius run loop\.$/m.test(text);
      return accepted
        ? [true, 'the entrypoint recorded a run accepted in READY and drove the loop']
        : [false, 'no accepted-and-driving line in the mission evidence'];
    },
  },
  {
    id: 'PROMPT ARCHITECT', path: true,
    build: () => built('src/relay/connectors/gpt-architect/index.ts', 'src/relay/mission/prompt-architect/prompt-architect-plan.ts'),
    prove: (ev) => {
      const plan = ev.rows('tasks.tsv').find((row) => row.role === 'PROMPT_ARCHITECT');
      if (plan === undefined) return [false, 'no PROMPT_ARCHITECT task in the run'];
      const artifact = ev.rows('evidence.tsv').find((row) => row.evidence_type === 'ARTIFACT' && row.status === 'PASSED');
      return plan.state === 'SUCCEEDED' && artifact !== undefined
        ? [true, `${plan.task_id} SUCCEEDED and stored a validated plan artifact`]
        : [false, `the architect task is ${plan.state} with ${artifact === undefined ? 'no' : 'an'} accepted artifact`];
    },
  },
  {
    id: 'CODING AGENT', path: true,
    // The third file is the one that governs what a Coding Agent dispatch may
    // spend. It was `relay-bridge/julius/coder-budget.ts` on the branch this
    // gate was written on; the landed answer is `julius-allocation.v1`, which
    // does the same job properly — mission budget → per-dispatch share →
    // reservation → adapter limit. Pointing a probe at a file that no longer
    // exists reports NOT BUILT for something that is built, which is the same
    // class of lie as reporting PASS for something that is not.
    build: () => built('relay-bridge/hosted-coding-agent/hosted-runner.ts', 'relay-bridge/julius/live-workers.ts', 'src/relay/mission/julius/julius-allocation-runtime.ts'),
    prove: (ev) => {
      const build = ev.rows('tasks.tsv').find((row) => row.task_type === 'build');
      if (build === undefined) return [false, 'no build task in the run'];
      if (build.state === 'SUCCEEDED') return [true, `${build.task_id} SUCCEEDED`];
      const why = ev.rows('failures.tsv').find((row) => row.task_id === build.task_id);
      return [false, `${build.task_id} is ${build.state}${why ? ` (${why.julius_code}/${why.failure_class || 'no class'})` : ''}`];
    },
  },
  {
    id: 'INDEPENDENT REVIEWER', path: true,
    build: () => built('relay-bridge/hermes-reviewer.ts', 'relay-bridge/hermes-remote-review.ts', 'src/relay/mission/reviewer-gate.ts'),
    prove: (ev) => {
      const review = ev.rows('tasks.tsv').find((row) => row.role === 'INDEPENDENT_REVIEWER');
      if (review === undefined) return [false, 'no INDEPENDENT_REVIEWER task in the run'];
      /**
       * A REVIEW THAT FOUND NOTHING IS THE BEST REVIEW, not a missing one.
       * Counting findings made an approving verdict score as a failure, which
       * would have marked the very run this gate exists to certify. What proves
       * the reviewer worked is a REVIEW_FINDING evidence row: the adapter writes
       * one on the approve path (`status: PASSED`) and one per finding on the
       * changes-required path, so it is present either way and absent only when
       * no review happened.
       */
      const reviewed = ev.rows('evidence.tsv').filter((row) => row.evidence_type === 'REVIEW_FINDING');
      const findings = ev.rows('findings.tsv').length;
      return review.state === 'SUCCEEDED' && reviewed.length > 0
        ? [true, `${review.task_id} SUCCEEDED and returned a structured review (${reviewed.length} review evidence row(s), ${findings} finding(s))`]
        : [false, `the reviewer task is ${review.state} with ${reviewed.length} review evidence row(s)`];
    },
  },
  {
    id: 'REPAIR LOOP', path: true,
    build: () => built('src/relay/mission/julius/julius-repair-runtime.ts'),
    prove: (ev) => {
      const repairs = ev.rows('tasks.tsv').filter((row) => row.task_type.startsWith('repair:'));
      if (repairs.length === 0) return [false, 'no repair task was created in this run'];
      const succeeded = repairs.filter((row) => row.state === 'SUCCEEDED');
      return succeeded.length > 0
        ? [true, `${succeeded.length} of ${repairs.length} repair task(s) SUCCEEDED`]
        : [false, `${repairs.length} repair task(s) created, none SUCCEEDED (${repairs.map((row) => row.state).join(', ')})`];
    },
  },
  {
    id: 'VERIFICATION', path: true,
    build: () => built('src/relay/mission/julius/julius-verification-runtime.ts'),
    prove: (ev) => {
      const decisions = ev.rows('decisions.tsv');
      return decisions.length > 0
        ? [true, `verification recorded ${decisions.length} decision(s): ${decisions.map((row) => `${row.action}/${row.reason_code}`).join(', ')}`]
        : [false, 'verification recorded no decision'];
    },
  },
  {
    id: 'VERIFIED COMPLETION', path: true,
    build: () => built('src/relay/mission/julius/julius-lifecycle-runtime.ts'),
    prove: (ev) => {
      const runs = ev.rows('runs.tsv');
      if (runs.length === 0) return [false, 'no run row in the evidence bundle'];
      return runs[0].state === 'COMPLETED'
        ? [true, `run ${runs[0].run_id} reached COMPLETED`]
        : [false, `run ${runs[0].run_id} ended ${runs[0].state}`];
    },
  },
  {
    id: 'WONDER WEB OUTPUT', path: false,
    build: () => builtAny('src/relay/mission/wonder-web/index.ts', 'src/relay/ui/wonder-web/index.ts', 'relay-bridge/wonder-web/index.ts'),
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
      const runs = ev.rows('runs.tsv');
      if (runs.length === 0 || runs[0].state !== 'COMPLETED') {
        return [false, 'no completed run, so there is no mission output for Wonder Web to open'];
      }
      const opened = ev.rows('wonder-web.tsv');
      return opened.length > 0
        ? [true, `${opened.length} mission output(s) recorded as opened in Wonder Web`]
        : [false, 'a completed run exists, but no wonder-web.tsv records its output being opened'];
    },
  },
  {
    id: 'PROJECT BRAIN PERSISTENCE', path: false,
    build: () => built('src/relay/mission/julius/julius-context-snapshot.ts', 'src/relay/shared/llmops/brain-memory.ts'),
    prove: (ev) => {
      if (!ev.present) return [false, 'no live evidence bundle'];
      if (ev.file('project-brain.tsv') === null) {
        return [false, 'this bundle carries no readable Project Brain dump, so no durable brain write is observable'];
      }
      /**
       * SEEDED IS NOT WRITTEN. The bootstrap inserts the mission's objective and
       * constraints with `worker_id = 'relay-bootstrap'` and no task id, before
       * a worker exists. A Project Brain that only ever holds those rows is a
       * read-only seed: the run's decisions, findings, repairs and handoffs —
       * five of the eight entry kinds migration 014 defines — did not persist.
       */
      const entries = ev.rows('project-brain.tsv');
      if (entries.length === 0) return [false, 'the Project Brain is empty: not even the mission seed persisted'];
      const written = entries.filter((row) => row.worker_id !== 'relay-bootstrap' || row.task_id !== '');
      return written.length > 0
        ? [true, `${written.length} of ${entries.length} Project Brain entries were written during the run (kinds: ${[...new Set(written.map((row) => row.entry_kind))].join(', ')})`]
        : [false, `all ${entries.length} Project Brain entries are bootstrap seeds; the run wrote none back`];
    },
  },
  {
    id: 'RESTART / RECOVERY', path: false,
    build: () => built('src/relay/mission/julius/julius-recovery.ts', 'src/relay/persistence/index.ts'),
    prove: (ev) => {
      const recovered = ev.rows('failures.tsv').filter((row) => row.recovery_action);
      return recovered.length > 0
        ? [true, `${recovered.length} recovery action(s) recorded`]
        : [false, 'no restart occurred in this run, so recovery is unexercised'];
    },
  },
  {
    id: 'FAILURE RECOVERY', path: false,
    build: () => built('src/relay/mission/julius/julius-execution-coordinator.ts', 'src/relay/mission/julius/julius-continuation.ts'),
    prove: (ev) => {
      const retries = ev.rows('failures.tsv').filter((row) => row.event_type === 'julius.retry.scheduled');
      if (retries.length === 0) return [false, 'no retryable failure occurred, so the path is unexercised'];
      const tasks = new Map(ev.rows('tasks.tsv').map((row) => [row.task_id, row.state]));
      const recovered = retries.filter((row) => tasks.get(row.task_id) === 'SUCCEEDED');
      return recovered.length > 0
        ? [true, `${recovered.length} task(s) failed retryably and then SUCCEEDED (e.g. ${recovered[0].failure_class || recovered[0].julius_code})`]
        : [false, `${retries.length} retry(s) scheduled, none reached SUCCEEDED`];
    },
  },
  {
    id: 'PERMISSIONS / MISSION BOUNDARIES', path: false,
    build: () => built('relay-bridge/hosted-coding-agent/hosted-envelope.ts', 'relay-bridge/julius/sandbox-limits.ts', 'src/relay/workspace/julius-tools/executor-operation-request.ts'),
    prove: (ev) => {
      /**
       * THE EVIDENCE OF A HELD BOUNDARY IS NOT A FAILED WORKER.
       *
       * `worker-diagnostics.tsv` carries a row only where `diag_transport` was
       * written, and that happens on the FAILURE paths — a run in which nothing
       * failed produces no rows at all. Requiring one made a clean run score
       * worse than a broken one, which is precisely backwards for a boundary.
       *
       * What proves containment on any run is the executor: signed receipts
       * exist, and every tool invocation it admitted reached a terminal
       * SUCCEEDED. Reported denials are then read as corroboration where they
       * exist — a NONZERO denial fails the row wherever it appears.
       */
      const receipts = (ev.file('receipt-ids.txt') ?? '').split('\n').filter((line) => /^[0-9a-f]{64}$/.test(line));
      const invocations = ev.rows('tool-invocations.tsv');
      const denials = ev.rows('worker-diagnostics.tsv').filter((row) => row.permission_denials !== '');
      const denied = denials.filter((row) => row.permission_denials !== '0');
      if (denied.length > 0) return [false, `${denied.length} worker run(s) reported a permission denial`];
      if (receipts.length === 0) return [false, 'no signed executor receipt exists, so no boundary is proven'];
      const unfinished = invocations.filter((row) => row.state !== 'SUCCEEDED');
      return unfinished.length === 0
        ? [true, `${receipts.length} signed executor receipt(s), ${invocations.length} tool invocation(s) all SUCCEEDED, ${denials.length} worker run(s) reporting 0 denials`]
        : [false, `${unfinished.length} tool invocation(s) did not reach SUCCEEDED (${unfinished.map((row) => row.state).join(', ')})`];
    },
  },
];

/* ------------------------------------------------------------- evaluation */

export function evaluate(evidenceDir) {
  const ev = loadEvidence(evidenceDir);
  const results = CAPABILITIES.map((capability) => {
    const { built: isBuilt, where } = capability.build();
    if (!isBuilt) return { id: capability.id, path: capability.path, verdict: 'NOT BUILT', basis: where };
    const [proven, basis] = capability.prove(ev);
    return { id: capability.id, path: capability.path, verdict: proven ? 'PASS' : 'FAIL', basis };
  });
  /**
   * THE TOP THREE, DETERMINISTICALLY. Creation-path capabilities that are not
   * PASS come first, in path order — a mission cannot reach a completion it
   * cannot walk to — then everything else in declared order.
   */
  const gaps = [
    ...results.filter((row) => row.path && row.verdict !== 'PASS'),
    ...results.filter((row) => !row.path && row.verdict !== 'PASS'),
  ].slice(0, 3);
  return { evidence: ev.present ? ev.source : null, evidenceNote: ev.source, results, gaps };
}

/* ----------------------------------------------------------------- output */

function main() {
  const report = evaluate(option('evidence'));
  if (flag('json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const out = (line) => process.stdout.write(`${line}\n`);
    out('WONDERLAND BETA GATE');
    out(`  evidence: ${report.evidence ?? `NONE (${report.evidenceNote ?? 'no --evidence given'})`}`);
    out('  PASS = built AND proven by real run evidence. FAIL = built, not proven. NOT BUILT = absent.');
    out('');
    const width = Math.max(...report.results.map((row) => row.id.length));
    for (const row of report.results) {
      out(`  ${row.id.padEnd(width)}  ${row.verdict.padEnd(9)}  ${row.basis}`);
    }
    out('');
    out('TOP THREE BETA GAPS');
    if (report.gaps.length === 0) out('  none — every capability is PASS');
    for (const [index, gap] of report.gaps.entries()) out(`  ${index + 1}. ${gap.id} — ${gap.verdict}: ${gap.basis}`);
    out('');
    const passing = report.results.filter((row) => row.verdict === 'PASS').length;
    out(`RESULT: ${passing === report.results.length ? 'BETA READY' : 'NOT BETA READY'} — ${passing}/${report.results.length} PASS`);
  }
  return report.results.every((row) => row.verdict === 'PASS') ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main());
