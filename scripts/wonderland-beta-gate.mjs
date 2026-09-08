#!/usr/bin/env node
/**
 * THE WONDERLAND BETA GATE.
 *
 * Fifteen capabilities. The gate answers TWO questions about each of them, and
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
 *                      broke), and no authoritative drill proves it either.
 *                      "We have the code" is not a pass at a beta gate;
 *                      neither is a green unit test.
 *   CAPABILITY PROVEN  This run did not exercise it, but a recorded drill did,
 *                      against the real production path, and the code it drove
 *                      has not changed since. Never available where the mission
 *                      itself must walk the capability (see MISSION-REQUIRED).
 *   PASS               This run exercised it and it worked. Mission proof is
 *                      the strongest answer and needs no drill.
 *
 * THREE RULES KEEP THE THIRD VERDICT FROM BECOMING A LAUNDRY:
 *
 *   A FAILED MISSION IS NEVER RESCUED. If the run exercised the capability and
 *   it broke, the verdict is FAIL whatever any drill says. A drill proves the
 *   path works; it cannot un-break what this run did.
 *
 *   MISSION-REQUIRED CAPABILITIES CANNOT BE DRILLED PAST. The eight a mission
 *   must itself walk to reach VERIFIED COMPLETION — creation, start, plan,
 *   build, contract lock, review, verification, completion — admit no
 *   capability proof at all. No drill makes a mission that never completed
 *   into one that did.
 *
 *   A CAPABILITY PROOF IS EVIDENCE, NOT AN ASSERTION. It is admissible only if
 *   a drill attestation names the production files it drove AND their content
 *   digests still match this repository AND those files cover the very probe
 *   this row is built on AND the drill's own transcript is present with every
 *   declared step passing. A drill that has gone stale against the code it
 *   proved reports CAPABILITY STALE and passes nothing.
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
 * its transcripts when they did not travel inside the bundle.
 *
 * Exit 0 only when every capability is PASS or CAPABILITY PROVEN. Anything
 * else exits 1, which is the honest answer to "are we ready for beta".
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
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
  const empty = { present: false, source: null, root: null, file: () => null, rows: () => [] };
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
  return { present: true, source: root, root, ...readers(root) };
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
function readers(root) {
  const file = (name) => {
    if (root === null || !/^[A-Za-z0-9._-]+$/u.test(name)) return null;
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
  return { file, rows };
}

/* ------------------------------------------------------ capability proofs */

/**
 * A DRILL THAT RAN, NOT A DRILL THAT EXISTS.
 *
 * `capability-proofs.tsv` is the ledger a drill writes about itself: which
 * capability it claims, which command it was, how many steps it declared, what
 * infrastructure it drove, WHICH PRODUCTION FILES it exercised with their
 * content digests at the moment it ran, and the transcript it left behind. One
 * row per exercised file; the gate groups by (capability, drill).
 *
 * Four things are checked, and a proof that misses any of them is inadmissible
 * rather than merely quiet:
 *
 *   OUTCOME. The drill said VERIFIED. Anything else is a drill that did not
 *   pass, and a drill that did not pass proves nothing.
 *
 *   CURRENCY. Every exercised file still exists and still hashes to the digest
 *   the drill recorded. A proof whose subject has been edited since is STALE:
 *   it describes code that is no longer here. This is why capability proofs
 *   expire on their own rather than accumulating as folklore.
 *
 *   COVERAGE. The exercised set contains every file this row's own build probe
 *   names. A drill for something else cannot be pointed at this capability,
 *   and a drill that touched one of two implementation files has not proven
 *   the capability the row is about.
 *
 *   TRANSCRIPT. The drill's own output is present, carries exactly the declared
 *   number of `[PASS]` steps, carries no `[FAIL]`, and ends on a VERIFIED line.
 *   The gate reads the drill's words rather than a summary word about them.
 */
const PROOF_COLUMNS = [
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
  if (PROOF_COLUMNS.some((column) => mine.every((row) => row[column] === undefined))) {
    return { state: 'UNPROVEN', basis: 'the attestation ledger is missing columns this gate reads' };
  }
  const drills = [...new Set(mine.map((row) => row.drill))];
  const refusals = [];
  for (const drill of drills) {
    const claimed = mine.filter((row) => row.drill === drill);
    const refuse = (state, basis) => refusals.push({ state, basis: `${drill}: ${basis}` });

    const failed = claimed.find((row) => row.outcome !== 'VERIFIED');
    if (failed !== undefined) { refuse('UNPROVEN', `the drill recorded ${failed.outcome || '(no outcome)'}, not VERIFIED`); continue; }

    const traversal = claimed.find((row) => !containedPath(row.exercised_path));
    if (traversal !== undefined) { refuse('UNPROVEN', `it names ${traversal.exercised_path || '(nothing)'}, which is not a file in this repository`); continue; }

    const moved = claimed.find((row) => digestOf(row.exercised_path) !== row.exercised_digest);
    if (moved !== undefined) {
      refuse('STALE', `${moved.exercised_path} has changed since the drill ran, so the drill no longer describes the code that is here`);
      continue;
    }

    const exercised = new Set(claimed.map((row) => row.exercised_path));
    const uncovered = probed.files.filter((path) => !exercised.has(path));
    if (uncovered.length > 0) { refuse('UNPROVEN', `it did not exercise ${uncovered.join(', ')}`); continue; }

    const transcriptName = claimed[0].transcript;
    const transcript = proofs.file(transcriptName);
    if (transcript === null) { refuse('UNPROVEN', `its transcript ${transcriptName || '(unnamed)'} is not in this bundle`); continue; }
    const passes = (transcript.match(/^\s*\[PASS\] /gmu) ?? []).length;
    const failures = (transcript.match(/^\s*\[FAIL\] /gmu) ?? []).length;
    const declared = Number.parseInt(claimed[0].steps, 10);
    if (!Number.isInteger(declared) || declared < 1) { refuse('UNPROVEN', 'it declares no step count, so its transcript cannot be held to one'); continue; }
    if (failures > 0) { refuse('UNPROVEN', `its transcript records ${failures} failed step(s)`); continue; }
    if (passes !== declared) { refuse('UNPROVEN', `it declares ${declared} step(s) and its transcript shows ${passes}`); continue; }
    const verdictLine = transcript.split('\n').map((line) => line.trim()).filter((line) => line.length > 0).pop() ?? '';
    if (!/^[A-Z][A-Z /-]* VERIFIED$/u.test(verdictLine)) { refuse('UNPROVEN', 'its transcript does not end on a VERIFIED line'); continue; }

    return {
      state: 'PROVEN',
      basis: `${drill} drove ${claimed.length} production file(s) against ${claimed[0].infrastructure || '(unstated infrastructure)'} and passed ${passes} step(s) on ${claimed[0].recorded_at || '(no recorded instant)'}`,
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
 *   NOT EXERCISED  the run never reached this behaviour — a flawless mission
 *                  never crashes, so it never recovers, and saying it FAILED
 *                  at recovery would be false
 *   UNKNOWN        the bundle cannot say. Never a default, never zero, never
 *                  inferred from the fact that something else is present.
 */
const exercised = (basis) => ({ mission: 'EXERCISED', basis });
const failed = (basis) => ({ mission: 'FAILED', basis });
const notExercised = (basis) => ({ mission: 'NOT EXERCISED', basis });
const unknown = (basis) => ({ mission: 'UNKNOWN', basis });

/**
 * THE OPERATOR IDENTITY, WHICH IS NOT AN ACCOUNT.
 *
 * Both bounded live missions declare `"tenantId": "tenant"`, and the workflow
 * runs them under `RELAY_BRIDGE_API_TOKEN` with `method: 'operator_token'`. A
 * mission owned by that identity proves the pipeline; it proves nothing about a
 * person signing up, creating a project and starting a run. Anything else in
 * `player_id` is a real account, and that is what flips the row.
 */
const OPERATOR_PLAYER_IDS = new Set(['tenant', 'operator']);

/**
 * `path: true` marks a capability on the creation path a mission must walk to
 * reach VERIFIED COMPLETION. The top-three ranking reads it, so the ordering is
 * a declared property rather than a judgement made at run time.
 *
 * `missionRequired: true` is the stronger statement, and it is what fences the
 * third verdict in: THIS capability must be exercised by the mission itself,
 * and no drill may stand in for it. The eight that carry it are the eight a run
 * physically walks between "a project exists" and "the run COMPLETED" — a drill
 * proving a coder can code does not make a mission that never built anything
 * into one that did.
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
      if (sessions.length === 0) return notExercised('no execution session was recorded, so no account owns this run');
      const owners = [...new Set(sessions.map((row) => row.player_id))];
      const real = owners.filter((owner) => !OPERATOR_PLAYER_IDS.has(owner));
      return real.length > 0
        ? exercised(`a mission ran for a non-operator account (${real.join(', ')})`)
        : notExercised(`every session is owned by the operator identity (${owners.join(', ')}), so no real account has started a mission`);
    },
  },
  {
    id: 'PROJECT CREATION', path: true, missionRequired: true,
    files: ['relay-bridge/julius/bootstrap.ts', 'relay-bridge/julius/mission-seed.ts'],
    prove: (ev) => {
      const runs = ev.rows('runs.tsv');
      if (runs.length === 0) return unknown('no run row in the evidence bundle');
      const projectBearing = ev.rows('tasks.tsv').length > 0 && runs[0].mission_id;
      return projectBearing
        ? exercised(`run ${runs[0].run_id} was created for mission ${runs[0].mission_id}`)
        : failed('a run row exists but names no mission');
    },
  },
  {
    id: 'JULIUS MISSION START', path: true, missionRequired: true,
    files: ['relay-bridge/julius-live-mission.ts', 'src/relay/mission/julius/julius-run-loop.ts'],
    prove: (ev) => {
      const text = ev.file('live-mission.evidence.txt');
      if (text === null) return unknown('this bundle carries no readable mission evidence, so how the run started is unknown');
      return /^Run \S+ accepted in state READY; driving the Julius run loop\.$/m.test(text)
        ? exercised('the entrypoint recorded a run accepted in READY and drove the loop')
        : failed('no accepted-and-driving line in the mission evidence');
    },
  },
  {
    id: 'PROMPT ARCHITECT', path: true, missionRequired: true,
    files: ['src/relay/connectors/gpt-architect/index.ts', 'src/relay/mission/prompt-architect/prompt-architect-plan.ts'],
    prove: (ev) => {
      const plan = ev.rows('tasks.tsv').find((row) => row.role === 'PROMPT_ARCHITECT');
      if (plan === undefined) return notExercised('no PROMPT_ARCHITECT task in the run');
      const artifact = ev.rows('evidence.tsv').find((row) => row.evidence_type === 'ARTIFACT' && row.status === 'PASSED');
      return plan.state === 'SUCCEEDED' && artifact !== undefined
        ? exercised(`${plan.task_id} SUCCEEDED and stored a validated plan artifact`)
        : failed(`the architect task is ${plan.state} with ${artifact === undefined ? 'no' : 'an'} accepted artifact`);
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
      const build = ev.rows('tasks.tsv').find((row) => row.task_type === 'build');
      if (build === undefined) return notExercised('no build task in the run');
      if (build.state === 'SUCCEEDED') return exercised(`${build.task_id} SUCCEEDED`);
      const why = ev.rows('failures.tsv').find((row) => row.task_id === build.task_id);
      return failed(`${build.task_id} is ${build.state}${why ? ` (${why.julius_code}/${why.failure_class || 'no class'})` : ''}`);
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
      if (!ev.present) return unknown('no live evidence bundle');
      if (ev.file('task-contracts.tsv') === null) {
        return unknown('this bundle carries no readable task-contract dump, so what the coder was charged with is unknown');
      }
      const contracts = ev.rows('task-contracts.tsv');
      if (contracts.length === 0) return notExercised('no task contract was authored for this run');
      const locked = contracts.filter((row) => row.state === 'LOCKED');
      if (locked.length === 0) {
        return failed(`${contracts.length} contract revision(s) exist and none was ever locked, so no build could be dispatched`);
      }
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
       * runtime saying it refused to run one of them. An older bundle without
       * that dump keeps the weaker proof, and SAYS it is the weaker one.
       */
      const contractEvents = ev.file('contract-events.tsv') === null ? null : ev.rows('contract-events.tsv');
      if (contractEvents === null) {
        return exercised(`${governing.contract_id} revision ${governing.contract_revision} locked at ${governing.locked_at} by ${governing.locked_by_evaluator_id || '(unrecorded)'}, governing ${build.task_id}; the binding it was RUN under is not measurable — this bundle carries no contract-events dump`);
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
      return exercised(`${governing.contract_id} revision ${governing.contract_revision} locked at ${governing.locked_at} by ${governing.locked_by_evaluator_id || '(unrecorded)'}, governing ${build.task_id}; the build${review === undefined ? '' : ' and its review'} were claimed under that revision and digest`);
    },
  },
  {
    id: 'INDEPENDENT REVIEWER', path: true, missionRequired: true,
    files: ['relay-bridge/hermes-reviewer.ts', 'relay-bridge/hermes-remote-review.ts', 'src/relay/mission/reviewer-gate.ts'],
    prove: (ev) => {
      const review = ev.rows('tasks.tsv').find((row) => row.role === 'INDEPENDENT_REVIEWER');
      if (review === undefined) return notExercised('no INDEPENDENT_REVIEWER task in the run');
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
        ? exercised(`${review.task_id} SUCCEEDED and returned a structured review (${reviewed.length} review evidence row(s), ${findings} finding(s))`)
        : failed(`the reviewer task is ${review.state} with ${reviewed.length} review evidence row(s)`);
    },
  },
  {
    /**
     * A MISSION THAT NEVER NEEDED A REPAIR HAS NOT FAILED AT REPAIRING.
     *
     * This row used to read FAIL whenever no repair task existed, which made
     * "the reviewer approved the build first time" — the best outcome the
     * product has — score identically to "the repair loop is broken". A run
     * with no rejection reports NOT EXERCISED, and the capability axis is then
     * the one that answers whether the loop works at all.
     */
    id: 'REPAIR LOOP', path: true, missionRequired: false,
    files: ['src/relay/mission/julius/julius-repair-runtime.ts'],
    prove: (ev) => {
      const repairs = ev.rows('tasks.tsv').filter((row) => row.task_type.startsWith('repair:'));
      if (repairs.length === 0) return notExercised('no review rejected anything in this run, so no repair was created');
      const succeeded = repairs.filter((row) => row.state === 'SUCCEEDED');
      return succeeded.length > 0
        ? exercised(`${succeeded.length} of ${repairs.length} repair task(s) SUCCEEDED`)
        : failed(`${repairs.length} repair task(s) created, none SUCCEEDED (${repairs.map((row) => row.state).join(', ')})`);
    },
  },
  {
    id: 'VERIFICATION', path: true, missionRequired: true,
    files: ['src/relay/mission/julius/julius-verification-runtime.ts'],
    prove: (ev) => {
      const decisions = ev.rows('decisions.tsv');
      return decisions.length > 0
        ? exercised(`verification recorded ${decisions.length} decision(s): ${decisions.map((row) => `${row.action}/${row.reason_code}`).join(', ')}`)
        : notExercised('verification recorded no decision');
    },
  },
  {
    id: 'VERIFIED COMPLETION', path: true, missionRequired: true,
    files: ['src/relay/mission/julius/julius-lifecycle-runtime.ts'],
    prove: (ev) => {
      const runs = ev.rows('runs.tsv');
      if (runs.length === 0) return unknown('no run row in the evidence bundle');
      return runs[0].state === 'COMPLETED'
        ? exercised(`run ${runs[0].run_id} reached COMPLETED`)
        : failed(`run ${runs[0].run_id} ended ${runs[0].state}`);
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
      const runs = ev.rows('runs.tsv');
      if (runs.length === 0 || runs[0].state !== 'COMPLETED') {
        return notExercised('no completed run, so there is no mission output for Wonder Web to open');
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
      if (!ev.present) return unknown('no live evidence bundle');
      if (ev.file('project-brain.tsv') === null) {
        return unknown('this bundle carries no readable Project Brain dump, so no durable brain write is observable');
      }
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
      if (entries.length === 0) return failed('the Project Brain is empty: not even the mission seed persisted');
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
     * The two never merge: a run that DID crash and recover still reads PASS
     * here, and stays distinguishable from one that never had to.
     */
    id: 'RESTART / RECOVERY', path: false, missionRequired: false,
    files: ['src/relay/mission/julius/julius-recovery.ts', 'src/relay/persistence/julius-recovery-postgres.ts', 'src/relay/persistence/index.ts'],
    prove: (ev) => {
      if (ev.file('failures.tsv') === null) {
        return unknown('this bundle carries no readable failure dump, so whether anything was recovered is unknown');
      }
      const recovered = ev.rows('failures.tsv').filter((row) => row.recovery_action);
      return recovered.length > 0
        ? exercised(`${recovered.length} recovery action(s) recorded (${[...new Set(recovered.map((row) => row.recovery_action))].join(', ')})`)
        : notExercised('nothing was interrupted in this run, so no lease was ever reclaimed');
    },
  },
  {
    id: 'FAILURE RECOVERY', path: false, missionRequired: false,
    files: ['src/relay/mission/julius/julius-execution-coordinator.ts', 'src/relay/mission/julius/julius-continuation.ts'],
    prove: (ev) => {
      if (ev.file('failures.tsv') === null) {
        return unknown('this bundle carries no readable failure dump, so whether anything was retried is unknown');
      }
      const retries = ev.rows('failures.tsv').filter((row) => row.event_type === 'julius.retry.scheduled');
      if (retries.length === 0) return notExercised('nothing failed retryably in this run, so no retry was scheduled');
      const tasks = new Map(ev.rows('tasks.tsv').map((row) => [row.task_id, row.state]));
      const recovered = retries.filter((row) => tasks.get(row.task_id) === 'SUCCEEDED');
      return recovered.length > 0
        ? exercised(`${recovered.length} task(s) failed retryably and then SUCCEEDED (e.g. ${recovered[0].failure_class || recovered[0].julius_code})`)
        : failed(`${retries.length} retry(s) scheduled, none reached SUCCEEDED`);
    },
  },
  {
    id: 'PERMISSIONS / MISSION BOUNDARIES', path: false, missionRequired: false,
    files: ['relay-bridge/hosted-coding-agent/hosted-envelope.ts', 'relay-bridge/julius/sandbox-limits.ts', 'src/relay/workspace/julius-tools/executor-operation-request.ts'],
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
      const receiptFile = ev.file('receipt-ids.txt');
      const receipts = (receiptFile ?? '').split('\n').filter((line) => /^[0-9a-f]{64}$/.test(line));
      const invocations = ev.rows('tool-invocations.tsv');
      const denials = ev.rows('worker-diagnostics.tsv').filter((row) => row.permission_denials !== '');
      const denied = denials.filter((row) => row.permission_denials !== '0');
      if (denied.length > 0) return failed(`${denied.length} worker run(s) reported a permission denial`);
      if (receiptFile === null) return unknown('this bundle carries no readable receipt list, so no boundary is observable');
      if (receipts.length === 0) return notExercised('no signed executor receipt exists, so nothing ran inside the boundary');
      const unfinished = invocations.filter((row) => row.state !== 'SUCCEEDED');
      return unfinished.length === 0
        ? exercised(`${receipts.length} signed executor receipt(s), ${invocations.length} tool invocation(s) all SUCCEEDED, ${denials.length} worker run(s) reporting 0 denials`)
        : failed(`${unfinished.length} tool invocation(s) did not reach SUCCEEDED (${unfinished.map((row) => row.state).join(', ')})`);
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
 * and broke it reads FAIL even where a drill proves the path works, because the
 * question "what did this run prove" has an answer and the answer is bad.
 * Only where the mission is silent — NOT EXERCISED, or a bundle that cannot say
 * — does the capability axis get to speak at all.
 */
function verdictOf(mission, capability, admissible) {
  if (mission === 'EXERCISED') return 'PASS';
  if (mission === 'FAILED') return 'FAIL';
  return admissible && capability === 'PROVEN' ? 'CAPABILITY PROVEN' : 'FAIL';
}

export function evaluate(evidenceDir, options = {}) {
  const ev = loadEvidence(evidenceDir);
  const proofs = loadProofs(ev, options.capabilityDir ?? null);
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
    const { mission, basis } = capability.prove(ev);
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
    return {
      ...common, verdict, mission,
      capability: admissible ? proof.state : 'NOT ADMISSIBLE',
      capabilityBasis,
      basis: verdict === 'CAPABILITY PROVEN'
        ? `NOT EXERCISED THIS MISSION — ${basis}; proven instead by a drill: ${proof.basis}`
        : (admissible && proof.state === 'STALE' ? `${basis}; the drill that once proved it is stale: ${proof.basis}` : basis),
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
  const count = (key, ...values) => results.filter((row) => values.includes(row[key])).length;
  return {
    evidence: ev.present ? ev.source : null,
    evidenceNote: ev.source,
    capabilitySource: proofs.rows.length > 0 ? proofs.source : null,
    results,
    gaps,
    summary: {
      total: results.length,
      exercised: count('mission', 'EXERCISED'),
      failed: count('mission', 'FAILED'),
      notExercised: count('mission', 'NOT EXERCISED'),
      unknown: count('mission', 'UNKNOWN'),
      provenByMission: count('verdict', 'PASS'),
      provenByDrill: count('verdict', 'CAPABILITY PROVEN'),
      unproven: count('verdict', 'FAIL'),
      notBuilt: count('verdict', 'NOT BUILT'),
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
    out('WONDERLAND BETA GATE');
    out(`  evidence:   ${report.evidence ?? `NONE (${report.evidenceNote ?? 'no --evidence given'})`}`);
    out(`  capability: ${report.capabilitySource ?? 'NONE (no drill attestation was supplied)'}`);
    out('  PASS = this run exercised it and it worked. CAPABILITY PROVEN = this run did not exercise it,');
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
    out(`  WHAT THIS RUN PROVED:       ${s.exercised} of ${s.total} exercised and working; ${s.failed} exercised and broken; ${s.notExercised} never reached; ${s.unknown} the bundle cannot say.`);
    out(`  WHAT JULIUS IS READY TO DO: ${s.provenByMission + s.provenByDrill} of ${s.total} proven — ${s.provenByMission} by this mission, ${s.provenByDrill} by drill; ${s.unproven} unproven; ${s.notBuilt} not built.`);
    out(`  BETA: ${s.provenByMission + s.provenByDrill === s.total ? 'READY' : 'NOT READY'}`);
  }
  return report.results.every((row) => row.verdict === 'PASS' || row.verdict === 'CAPABILITY PROVEN') ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main());
